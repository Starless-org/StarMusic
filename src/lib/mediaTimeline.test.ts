import { expect, test } from "bun:test";
import { mediaTimelineMoved } from "./mediaTimeline";

test("normal playback ticks leave the remote clock running", () => {
  const previous = { positionMs: 10000, at: 100, playing: true };
  expect(mediaTimelineMoved(previous, 10500, 600)).toBe(false);
  expect(mediaTimelineMoved(previous, 30000, 20100)).toBe(false);
  expect(mediaTimelineMoved(previous, 10500, 850)).toBe(false);
});

test("forward and backward seeks reset the remote clock", () => {
  const previous = { positionMs: 30000, at: 100, playing: true };
  expect(mediaTimelineMoved(previous, 90000, 600)).toBe(true);
  expect(mediaTimelineMoved(previous, 10000, 600)).toBe(true);
});

test("a paused clock stays still but can be repositioned", () => {
  const previous = { positionMs: 30000, at: 100, playing: false };
  expect(mediaTimelineMoved(previous, 30000, 20100)).toBe(false);
  expect(mediaTimelineMoved(previous, 60000, 600)).toBe(true);
});
