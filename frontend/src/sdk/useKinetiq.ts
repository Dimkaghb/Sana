import { useEffect, useRef, useState } from "react";
import { KinetiqSDK } from "./kinetiq-sdk";

export function useKinetiq(
  account: string,
  enabled: boolean,
  onCommand: () => void,
) {
  const handler = useRef(onCommand);
  const [sdk, setSdk] = useState<KinetiqSDK>();
  useEffect(() => {
    handler.current = onCommand;
  }, [onCommand]);
  useEffect(() => {
    if (!enabled) {
      setSdk(undefined);
      return;
    }
    const instance = new KinetiqSDK(account);
    instance.start(() => handler.current());
    setSdk(instance);
    return () => instance.stop();
  }, [account, enabled]);
  return sdk;
}
