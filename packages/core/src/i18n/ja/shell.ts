import type { MessagesOtherOnly } from "../types.ts";
import type { shell as source } from "../zh/shell.ts";

export const shell: MessagesOtherOnly<typeof source> = {
  nav: {
    saves: "セーブ",
    library: "シナリオ",
    settings: "設定",
    count_other: "{{count}} 件",
    main: "メインナビゲーション",
    expandSidebar: "サイドバーを開く",
    collapseSidebar: "サイドバーを閉じる",
    recent: "最近のセーブ",
    noNickname: "ニックネーム未設定",
    recentGroups: {
      today: "今日",
      week: "今週",
      earlier: "それ以前",
    },
    moreFor: "「{{title}}」のその他の操作",
  },
  notFound: {
    title: "ページが見つかりません",
    heading: "このページは見つかりません",
    text: "アドレスが間違っているか、内容が削除された可能性があります。<link>セーブに戻る</link>",
  },
  shortcuts: {
    title: "キーボードショートカット",
    single: "1 キーのショートカット",
    singleNote:
      "英字、/、[、? は文字を入力していないときだけ有効です。スクリーンリーダーや音声入力を使うときはオフにできます",
    reading: "読む",
    app: "画面",
    items: {
      pick: "選択肢を選び、Enter で送信",
      write: "自分で書く",
      send: "送信",
      newline: "改行",
      collapse: "入力欄を閉じる（下書きは残ります）",
      latest: "最新に戻る",
      world: "世界の状態を開く・閉じる",
      sidebar: "サイドバーを開く・閉じる",
      help: "この一覧を表示",
      close: "メニュー、ダイアログ、スライドしたパネルを閉じる",
    },
  },
  import: {
    dropTitle: "離すと読み込みます",
    dropFormats: "PNG（カード画像にデータ入り）または JSON（テキストのキャラクターカード）、最大 16 MB",
    dropSupports: "SillyTavern V1、V2、V3 に対応。複数枚まとめてドロップできます",
    imported_other: "キャラクターカードを {{count}} 枚読み込みました",
    duplicates_other: "{{count}} 枚はすでに読み込み済みです",
    failed_other: "{{count}} 枚は読み込めませんでした",
  },
  splash: {
    restoring: "ログイン状態を復元しています",
  },
  server: {
    title: "サーバー",
    rowLabel: "サーバー {{server}}、変更",
    label: "サーバー",
    change: "変更",
    choose: "サーバーを選ぶ",
    failedRecently: "さきほど接続できませんでした",
    lastUsed: "前回の使用 · {{time}}",
    newAddress: "新しいアドレスを入力",
    newPlaceholder: "新しいアドレスを入力（例：http://192.168.1.10:8000）",
    newLabel: "新しいサーバーのアドレス",
    test: "接続をテスト",
    useThis: "このアドレスを使う",
  },
};
