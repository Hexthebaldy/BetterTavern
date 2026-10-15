/**
 * 载入的手机诊断日志：只放在这个网页的内存里（刷新页面就没了），不上传到任何地方。
 * 原始日志页和请求详情页会把它和服务端的记录放在一起显示。
 */

import { createContext, useContext, useState, type ReactNode } from "react";

import { parsePhoneLog, type PhoneLog } from "./lib/phone.ts";

type Value = {
  phone: PhoneLog | null;
  load: (text: string, name: string) => PhoneLog;
  clear: () => void;
  name: string | null;
};

const PhoneContext = createContext<Value | null>(null);

export function PhoneProvider({ children }: { children: ReactNode }) {
  const [phone, setPhone] = useState<PhoneLog | null>(null);
  const [name, setName] = useState<string | null>(null);
  const value: Value = {
    phone,
    name,
    load: (text, fileName) => {
      const parsed = parsePhoneLog(text);
      setPhone(parsed);
      setName(fileName);
      return parsed;
    },
    clear: () => {
      setPhone(null);
      setName(null);
    },
  };
  return <PhoneContext.Provider value={value}>{children}</PhoneContext.Provider>;
}

export function usePhone(): Value {
  const value = useContext(PhoneContext);
  if (!value) throw new Error("usePhone 必须在 PhoneProvider 里用");
  return value;
}
