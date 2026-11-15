/** Verify the active worker has finished preparing the explicit public application shell. */
export async function offlineShellReady(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || typeof MessageChannel === "undefined")
    return false;
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    if (!registration?.active) return false;
    return await new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        resolve(false);
      }, 2000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data?.version === 2 && event.data?.ready === true);
      };
      registration.active!.postMessage("AGRI_PUBLIC_SHELL", [channel.port2]);
    });
  } catch {
    return false;
  }
}
