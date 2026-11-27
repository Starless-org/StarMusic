/** A normal position tick advances the remote clock by itself. A seek resets it. */
export function mediaTimelineMoved(
  previous: { positionMs: number; at: number; playing: boolean },
  positionMs: number,
  at: number,
) {
  const expected = previous.positionMs + (previous.playing ? at - previous.at : 0);
  // Backend status is sampled independently of React. Allow one second of
  // scheduling jitter so regular ticks do not consume Discord's update budget.
  return Math.abs(positionMs - expected) > 1000;
}
