export interface DatasetIndex {
  moods: Record<string, string>;
  genres: Record<string, string>;
}

export interface PlaylistItem {
  id: string;
  name: string;
  thumbnailId: string;
}

export type CategoryDetails = Record<string, PlaylistItem[]>;

export interface CategoryItem {
  name: string;
  slug: string;
  id: string;
}
