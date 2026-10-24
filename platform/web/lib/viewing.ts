import { cache } from 'react';

/** The account the team is viewing in this request (Admin > View as), if any: its queries run read-only. */
const state = cache(() => ({ id: null as string | null }));
export const viewingId = () => state().id;
export const setViewing = (id: string) => { state().id = id; };
