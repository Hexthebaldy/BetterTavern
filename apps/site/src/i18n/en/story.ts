/** 英文的演示故事《Fog Harbor Watch》（雾港守夜人）：首屏演示的段落和世界条目，“世界状态”一节关系图的文字。人名换成了英文的 */

import type { StoryText } from "../../demo/story.ts";
import type { WorldText } from "../../world/graph.ts";

export const story: StoryText = {
  title: "Fog Harbor Watch",
  defaultName: "Rowan",
  nameMax: 16,
  tickChars: 6,
  text: {
    root: "The fog came in off the sea. By the time I reached the end of the pier, it had swallowed the railings. The lighthouse stood just ahead, but its lamp was dark.\n\nOld Hale had written in his letter: once the Fog Harbor light goes out, someone has to go and light it again — and the man who wrote that letter had been missing for three days.\n\nBehind me a bell rang once, low and wet, as if it had floated up from under the water.",
    a: "The stairs inside the tower were narrow and steep. Halfway up, I heard pages turning above me.\n\nThe door to the lamp room stood half open. A woman in a grey coat sat beside the dead lamp, a logbook open on her knees. She looked up as if she had been waiting for me.\n\n“{n}?” she said. “Hale told me you'd come.”",
    b: "The bell was ringing from an old ship out in the fog. Her hull bore no name, and her mooring lines were still dripping.\n\nI had barely set foot on the gangplank when the bell rang again, right beside my ear this time. Behind the cabin door, someone spoke in a low voice:\n\n“Don't light the lamp, {n}. Once it's lit, they'll know you're here.”",
    aa: "“He went after a ship,” the woman said, closing the logbook. “A ship that sank thirty years ago.”\n\nShe pushed a box of matches toward me. “The lamp is yours to light. Once it's burning, you'll see what he saw.”\n\nAs I struck the match, a second light came on in the fog outside the window. But Fog Harbor has only one lighthouse.",
    ab: "The last page of the logbook was in Hale's hand, the ink still wet:\n\n“They'll come back tonight. As long as the lamp is lit, the ship can't make land.”\n\nThe line below was written in a hurry: “If I don't come back, tell {n} — don't trust the bell.” I looked up. The woman in the grey coat was gone, and her chair was still warm.",
    ba: "There was only a child in the cabin, hugging an unlit lantern and shivering with cold.\n\nHe said his name was Finn, Old Hale's grandson. “Grandpa says when the bell rings three times, someone's coming back.”\n\nHe stared at the fog behind me and whispered, “It's rung twice already.”",
    bb: "I went back down the pier; the fog was already over my ankles. As I reached the foot of the lighthouse, the bell rang a third time.\n\nThe tower door stood open. A trail of wet footprints led up the stairs — someone had got there before me.",
  },
  options: {
    root: ["Climb the lighthouse and light the lamp", "Go back and find the bell"],
    a: ["Ask her where Hale went", "Look at the logbook first"],
    b: ["Push the cabin door open", "Go back to the pier and light the lamp"],
  },
  entities: {
    me: { name: "{n}", note: "the new night watch" },
    pier: { name: "Fog Harbor pier", note: "the fog is over the railings" },
    tower: { name: "Lighthouse", note: "the lamp is dark" },
    keeper: { name: "Old Hale", note: "the keeper, missing for three days" },
    bell: { name: "Old ship's bell", note: "sounds as if it rises from under the water" },
    grey: { name: "Woman in the grey coat", note: "seems to have been waiting for me" },
    log: { name: "Logbook", note: "in Hale's handwriting" },
    ship: { name: "Nameless old ship", note: "her mooring lines are still dripping" },
    voice: { name: "Voice behind the cabin door", note: "doesn't want me to light the lamp" },
    chao: { name: "Finn", note: "Hale's grandson; it was his voice behind the door" },
    f_light: { name: "A second light came on in the fog", note: "but Fog Harbor has only one lighthouse" },
    f_bell: { name: "The logbook says: don't trust the bell", note: "Hale's last words" },
    f_steps: { name: "Wet footprints on the stairs", note: "someone got there first" },
  },
  kinds: { person: "Person", place: "Place", item: "Item", fact: "Fact" },
  me: "Me",
  thinking: "Thinking…",
  writingOpening: "Writing the opening",
  writingNext: "Writing the next part",
};

export const world: WorldText = {
  nodes: {
    me: { label: "Me", desc: "The new night watch. Goal: light the lamp again." },
    tower: { label: "Lighthouse", desc: "At the end of the pier. Its lamp is dark." },
    grey: { label: "Woman in grey", desc: "Attitude: acts as if she has known me for years. Speaks softly and slowly." },
    log: { label: "Logbook", desc: "The ink on the last page is still wet." },
    keeper: { label: "Old Hale", desc: "The lighthouse keeper. Missing for three days." },
    chao: { label: "Finn", desc: "Hugging an unlit lantern, shivering with cold." },
    ship: { label: "Old ship", desc: "No name on her hull; her mooring lines are still dripping." },
    bell: { label: "Ship's bell", desc: "When it rings three times, someone is coming back." },
    pier: { label: "Pier", desc: "Fog rising off the sea has swallowed the railings." },
  },
  edges: {
    "me-tower": { fromA: ["in the", "Lighthouse", ""], fromB: ["", "I", "am here"] },
    "grey-tower": { fromA: ["in the", "Lighthouse", ""], fromB: ["", "Woman in grey", "is here"] },
    "tower-pier": { fromA: ["at the end of the", "Pier", ""], fromB: ["", "Lighthouse", "at its end"] },
    "grey-log": { fromA: ["holds the", "Logbook", ""], fromB: ["held by the", "Woman in grey", ""] },
    "log-keeper": { fromA: ["written by", "Old Hale", ""], fromB: ["wrote the", "Logbook", ""] },
    "keeper-chao": { fromA: ["grandfather of", "Finn", ""], fromB: ["grandson of", "Old Hale", ""] },
    "chao-ship": { fromA: ["hiding in the", "Old ship", ""], fromB: ["", "Finn", "is in the cabin"] },
    "ship-bell": { fromA: ["", "Ship's bell", "hangs here"], fromB: ["hangs on the", "Old ship", ""] },
    "pier-ship": { fromA: ["", "Old ship", "is moored here"], fromB: ["moored at the", "Pier", ""] },
    secret: { fromA: ["died on the", "Old ship", "30 years ago"], fromB: ["", "Old Hale", "died here 30 years ago"] },
  },
  secret: "Old Hale died on that sunken ship thirty years ago.",
  kinds: { person: "Person", place: "Place", item: "Item" },
  meKind: "Protagonist",
  nodeAria: "{label}, {kind}",
  meAria: "{label}, {name}, {kind}",
};
