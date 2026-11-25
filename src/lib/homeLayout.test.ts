import { describe, expect, test } from "bun:test";
import {
  addTile,
  DEFAULT_LAYOUT,
  moveItem,
  normaliseHomeLayout,
  QUICK_MAX,
  removeTile,
  SHELVES,
  shownTiles,
} from "./homeLayoutModel";

const LIST = "37i9dQZF1DXcBWIGoYBM5M";
const OTHER = "0vvXsWCC9xrXsKd4FyS8kM";

describe("normaliseHomeLayout", () => {
  test("nothing saved is the default layout", () => {
    expect(normaliseHomeLayout(null)).toEqual(DEFAULT_LAYOUT);
  });

  test("keeps the saved order and appends the shelves it does not mention", () => {
    const layout = normaliseHomeLayout({ shelves: [{ id: "madeForYou", hidden: true }] });
    expect(layout.shelves[0]).toEqual({ id: "madeForYou", hidden: true });
    expect(layout.shelves.map((shelf) => shelf.id).sort()).toEqual([...SHELVES].sort());
  });

  test("drops unknown and repeated shelves, and unknown tiles", () => {
    const layout = normaliseHomeLayout({
      shelves: [
        { id: "yourWeek", hidden: false },
        // biome-ignore lint/suspicious/noExplicitAny: an id from another version.
        { id: "podcasts" as any, hidden: false },
        { id: "yourWeek", hidden: true },
      ],
      quick: ["liked", "../x", LIST, LIST],
    });
    expect(layout.shelves.filter((shelf) => shelf.id === "yourWeek")).toEqual([
      { id: "yourWeek", hidden: false },
    ]);
    expect(layout.shelves).toHaveLength(SHELVES.length);
    expect(layout.quick).toEqual(["liked", LIST]);
  });
});

describe("quick access", () => {
  test("moving a tile keeps the others in order", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });

  test("adding goes to the end, once, and stops at the limit", () => {
    expect(addTile(["liked"], LIST)).toEqual(["liked", LIST]);
    expect(addTile(["liked", LIST], LIST)).toEqual(["liked", LIST]);
    const full = Array.from({ length: QUICK_MAX }, (_, index) => `${index}`.padStart(22, "x"));
    expect(addTile(full, OTHER)).toEqual(full);
  });

  test("removing takes only that tile", () => {
    expect(removeTile(["liked", "dj", LIST], "dj")).toEqual(["liked", LIST]);
  });

  test("a deleted playlist, or a DJ the account does not have, is not drawn", () => {
    const exists = (id: string) => id === LIST;
    expect(shownTiles(["liked", "dj", LIST, OTHER], exists, false)).toEqual(["liked", LIST]);
    expect(shownTiles(["dj", OTHER], exists, true)).toEqual(["dj"]);
  });
});
