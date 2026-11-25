import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_LAYOUT, type HomeLayout } from "./homeLayoutModel";
import { homeLayout, keys, setHomeLayout, useAccount } from "./spotify";

export type { HomeLayout, HomeView, Shelf, ShelfId, TileId } from "./homeLayoutModel";

/**
 * How Home is arranged for the signed-in account, and how to change it.
 *
 * **The change shows before the disk answers.** A tile that is dropped has to
 * stay where the finger left it: waiting for the write would draw it back in
 * its old place for a moment and then jump. The new layout goes into the cache
 * first, and the backend's answer —the same layout, normalised— replaces it.
 * If the write fails, the layout the disk still has comes back.
 */
export function useHomeLayout() {
  const accountQuery = useAccount();
  const account = accountQuery.data?.id ?? null;
  const client = useQueryClient();
  const key = keys.homeLayout(account);
  const query = useQuery({
    queryKey: key,
    enabled: account !== null,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<HomeLayout> => (account ? homeLayout(account) : DEFAULT_LAYOUT),
  });
  const mutation = useMutation({
    mutationKey: key,
    scope: { id: `home-layout:${account}` },
    mutationFn: async (layout: HomeLayout) => {
      if (!account) throw new Error("no_session");
      return { account, layout: await setHomeLayout(account, layout) };
    },
    onMutate: (layout) => {
      const before = client.getQueryData<HomeLayout>(key);
      client.setQueryData<HomeLayout>(key, layout);
      return { before };
    },
    onError: (_error, _layout, context) => {
      client.setQueryData<HomeLayout>(key, context?.before ?? DEFAULT_LAYOUT);
    },
    onSuccess: ({ account, layout }) => {
      // A save may finish after sign-out: never apply it to the new account.
      client.setQueryData<HomeLayout>(keys.homeLayout(account), layout);
    },
  });
  return {
    layout: query.data ?? DEFAULT_LAYOUT,
    save: mutation.mutate,
  };
}
