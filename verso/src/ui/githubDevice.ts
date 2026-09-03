import { useCallback, useEffect, useRef, useState } from "react";

import { openExternalPage } from "../host/external";
import type { GitHubDeviceAuthorization, GitHubDevicePoll } from "../core/types";

/**
 * GitHub App 设备授权的轮询循环。DESIGN.md §2.8
 *
 * **为什么抽出来。** 连接 GitHub 的入口不止一个：设置面板里有，加入共享空间时
 * 也得能就地连（把受邀者赶去设置面板、再让他自己找回那个弹窗，是最容易让人
 * 半路放弃的一段）。而这段循环有几处细节错了就只在特定时刻出问题 ——
 * `slow_down` 的额外等待、串行而非定时器叠加、失败后必须离开验证码态 ——
 * 抄第二份迟早会分叉。
 */
export function useGitHubDeviceConnect(options: {
  begin: () => Promise<GitHubDeviceAuthorization>;
  poll: (deviceCode: string) => Promise<GitHubDevicePoll>;
  onBusy: (busy: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const [authorization, setAuthorization] = useState<GitHubDeviceAuthorization | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  // 回调每次渲染都是新函数；放进 ref，轮询链才不会因为父组件重渲染而重建
  const latest = useRef(options);
  latest.current = options;

  /**
   * 这一轮授权的序号。**取消不能只清定时器** —— 已经发出去、还没回来的那次
   * 请求管不住：`begin()` 是一整趟 GitHub 往返，在验证码出来之前关掉对话框，
   * 它回来照样弹一个浏览器标签页，并在一个已经不存在的组件上开始轮询，
   * 直到设备码过期（约 15 分钟）。
   *
   * 还有更怪的一种：取消后立刻重来，旧轮询回来时会把新的定时器顺手清掉再
   * 装上自己的 —— 卡片上显示新验证码，实际等的是旧设备码，授权完永远等不到。
   */
  const generation = useRef(0);

  /** 只清定时器，不作废这一轮。`schedule` 用它 */
  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    clearTimer();
  }, [clearTimer]);

  useEffect(() => stop, [stop]);

  const schedule = useCallback(
    (auth: GitHubDeviceAuthorization, delaySeconds: number) => {
      clearTimer();
      const mine = generation.current;
      timer.current = window.setTimeout(() => {
        if (generation.current !== mine) return;
        check(auth);
      }, Math.max(1, delaySeconds) * 1000);
    },
    [clearTimer],
  );

  function check(auth: GitHubDeviceAuthorization) {
    if (inFlight.current) return;
    const mine = generation.current;
    inFlight.current = true;
    latest.current.onBusy(true);
    latest.current.onError(null);
    void latest.current
      .poll(auth.deviceCode)
      .then((result) => {
        // 这一轮已经被取消（关了对话框、或者用户重新点了一次连接）
        if (generation.current !== mine) return;
        if (result.account) {
          stop();
          setAuthorization(null);
          setMessage(null);
        } else {
          setMessage(
            result.retryAfter > 0
              ? `GitHub 要求稍候，${auth.interval + result.retryAfter} 秒后会再检查。`
              : "正在等待 GitHub 确认；完成授权后会自动继续检查。",
          );
          // 只有本次请求结束后才安排下一次，避免固定 interval 与手动检查重叠，
          // 也能严格遵守 GitHub 在 slow_down 时额外给出的等待时间。
          schedule(auth, auth.interval + result.retryAfter);
        }
      })
      .catch((error) => {
        if (generation.current !== mine) return;
        // 过期、取消或网络错误都要离开验证码态；一直留着一张无法继续的卡片
        // 比报错更像是界面死掉了，也让用户不知道该重新开始。
        stop();
        setAuthorization(null);
        setMessage(null);
        latest.current.onError((error as Error).message);
      })
      .finally(() => {
        inFlight.current = false;
        latest.current.onBusy(false);
      });
  }

  const start = useCallback(() => {
    stop();
    const mine = generation.current;
    latest.current.onBusy(true);
    latest.current.onError(null);
    setMessage(null);
    void latest.current
      .begin()
      .then((auth) => {
        // 这一趟往返期间对话框可能已经关了。**尤其不能再弹浏览器** ——
        // 用户明明取消了，屏幕上却突然多出一个 GitHub 授权页
        if (generation.current !== mine) return;
        setAuthorization(auth);
        openExternalPage(auth.verificationUri);
        // 自动检查之外也提供明确的手动入口：用户在网页确认后，不需要猜是继续
        // 等待还是点哪里。轮询是串行的，绝不会并发叠加。
        schedule(auth, auth.interval);
        latest.current.onBusy(false);
      })
      .catch((error) => {
        if (generation.current !== mine) return;
        latest.current.onError((error as Error).message);
        latest.current.onBusy(false);
      });
  }, [stop, schedule]);

  const cancel = useCallback(() => {
    stop();
    setAuthorization(null);
    setMessage(null);
  }, [stop]);

  const openPage = useCallback(() => {
    if (authorization) openExternalPage(authorization.verificationUri);
  }, [authorization]);

  return { authorization, message, start, cancel, openPage };
}
