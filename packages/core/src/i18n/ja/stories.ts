import type { MessagesOtherOnly } from "../types.ts";
import type { stories as source } from "../zh/stories.ts";

export const stories: MessagesOtherOnly<typeof source> = {
  stories: {
    cardHint: "セーブを開きます。長押しで名前の変更や削除ができます",
    emptyTitle: "セーブはまだありません",
    emptyText:
      "「シナリオ」でキャラクターカードを読み込み、自分が演じる人物を決めると、最初の場面が書かれます。",
    emptyAction: "キャラクターカードを読み込む",
    renameTitle: "セーブの名前を変更",
    nameLabel: "セーブ名",
    deleteMessage: "削除すると、このセーブの物語と世界の状態は元に戻せません。",
    offline: "サーバー <mono>{{server}}</mono> に接続できず、一覧を読み込めませんでした",
    offlineShort: "サーバーに接続できず、一覧を読み込めませんでした",
    resume: "続きから",
    turnN: "第 {{n}} ターン",
    openingTurn: "オープニング",
    newStory: "新しい物語 ＋",
    newStoryNote: "シナリオを選んで主人公に名前をつければ、最初の場面がすぐに書かれます",
    pageSummary_other: "全 {{count}} 件のセーブ · このページ {{n}} 件",
    pickScenario: "シナリオを選ぶ",
    status: {
      ended: "完結",
      writingOpening: "冒頭を執筆中",
      writingNext: "次の場面を執筆中",
      noOpening: "冒頭がまだできていません",
    },
  },
};
