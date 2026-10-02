export type ChatRoomPlaybackCommand = "PREVIOUS" | "NEXT" | "PAUSE" | "RESUME";

function normalizeCommandText(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .replace(/[\s，。！？!?、,.;；:：~～…]+/g, "");
}

const PREFIX = "(?:小安)?(?:请|麻烦|可以)?(?:帮我)?(?:把歌)?";
const SUFFIX = "(?:一下|一下下)?(?:吧|呢|哦|呀|啦|可以吗|好不好)?";

const COMMAND_PATTERNS: Array<{
  command: ChatRoomPlaybackCommand;
  pattern: RegExp;
}> = [
  {
    command: "PREVIOUS",
    pattern: new RegExp(`^${PREFIX}(?:切到|切换到|播放)?(?:上一首|上一首歌)${SUFFIX}$`),
  },
  {
    command: "NEXT",
    pattern: new RegExp(`^${PREFIX}(?:切到|切换到|播放)?(?:下一首|下一首歌)${SUFFIX}$`),
  },
  {
    command: "PAUSE",
    pattern: new RegExp(`^${PREFIX}(?:先)?(?:暂停|暂停播放|停一下)${SUFFIX}$`),
  },
  {
    command: "RESUME",
    pattern: new RegExp(`^${PREFIX}(?:继续|继续播放|恢复播放|开始播放)${SUFFIX}$`),
  },
];

export function parseChatRoomPlaybackCommand(text: string): ChatRoomPlaybackCommand | null {
  const normalized = normalizeCommandText(text);
  if (!normalized) return null;

  for (const { command, pattern } of COMMAND_PATTERNS) {
    if (pattern.test(normalized)) return command;
  }
  return null;
}
