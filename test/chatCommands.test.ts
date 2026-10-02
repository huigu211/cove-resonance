import assert from "node:assert/strict";
import test from "node:test";
import { parseChatRoomPlaybackCommand } from "../src/netease/chatCommands.js";

test("parses explicit ChatRoom playback commands", () => {
  assert.equal(parseChatRoomPlaybackCommand("上一首"), "PREVIOUS");
  assert.equal(parseChatRoomPlaybackCommand("小安，切到下一首歌呢！"), "NEXT");
  assert.equal(parseChatRoomPlaybackCommand("小安帮我暂停一下吧"), "PAUSE");
  assert.equal(parseChatRoomPlaybackCommand("继续播放"), "RESUME");
});

test("does not treat ordinary conversation as a playback command", () => {
  assert.equal(parseChatRoomPlaybackCommand("我觉得下一首可能会更好听"), null);
  assert.equal(parseChatRoomPlaybackCommand("你想继续聊刚才的事情吗"), null);
  assert.equal(parseChatRoomPlaybackCommand("暂停一下，我还没说完"), null);
});
