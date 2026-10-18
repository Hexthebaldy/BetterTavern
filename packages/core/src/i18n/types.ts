/**
 * 资源的形状：其他语言由中文的资源推出来，少 key、多 key 在类型检查时都会报错。
 * 复数：中文只写 key_other。有单复数的语言（英文）用 Messages，对每个 key_other 还要写 key_one；
 * 没有单复数的语言（日文）用 MessagesOtherOnly，和中文一样只写 key_other。
 */

type PluralOne<K> = K extends `${infer Base}_other` ? `${Base}_one` : never;

export type Messages<T> = {
  [K in keyof T]: T[K] extends string ? string : Messages<T[K]>;
} & {
  [K in keyof T as PluralOne<K>]: string;
};

export type MessagesOtherOnly<T> = {
  [K in keyof T]: T[K] extends string ? string : MessagesOtherOnly<T[K]>;
};
