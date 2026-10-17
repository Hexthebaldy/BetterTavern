import type { Messages } from "../types.ts";
import type { stories as source } from "../zh/stories.ts";

export const stories: Messages<typeof source> = {
  stories: {
    cardHint: "Opens the save. Long-press to rename or delete.",
    emptyTitle: "No saves yet",
    emptyText:
      "Import a character card in Library and choose who you'll play. The first part of the story will be written for you.",
    emptyAction: "Import a character card",
    renameTitle: "Rename save",
    nameLabel: "Save name",
    deleteMessage: "The story and world state in this save will be gone for good.",
    offline: "Can't reach the server <mono>{{server}}</mono>, so the list didn't load",
    offlineShort: "Can't reach the server, so the list didn't load",
    status: {
      ended: "Ended",
      writingOpening: "Writing the opening…",
      writingNext: "Writing the next part…",
      noOpening: "Opening not written yet",
    },
  },
};
