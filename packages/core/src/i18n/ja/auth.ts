import type { MessagesOtherOnly } from "../types.ts";
import type { auth as source } from "../zh/auth.ts";

export const auth: MessagesOtherOnly<typeof source> = {
  auth: {
    loginTitle: "物語の続きへ",
    registerTitle: "アカウントを作成",
    tagline: "キャラクターカードを読み込んで、一人称で物語を紡ぎましょう。",
    taglineLines: "キャラクターカードを読み込んで、\n一人称で物語を紡ぎましょう。",
    email: "メールアドレス",
    password: "パスワード",
    passwordPlaceholder: "パスワードを入力",
    passwordMin: "{{min}} 文字以上",
    passwordTyped: "{{length}} 文字入力済み、{{min}} 文字以上",
    passwordLength_other: "{{count}} 文字",
    showPassword: "パスワードを表示",
    hidePassword: "パスワードを隠す",
    nickname: "ニックネーム",
    login: "ログイン",
    register: "登録",
    registerAndLogin: "登録してログイン",
    noAccount: "アカウントをお持ちでないですか？",
    backToLogin: "ログインに戻る",
    cantConnect: "サーバーに接続できません。アドレスかネットワークを確認してください。",
  },
};
