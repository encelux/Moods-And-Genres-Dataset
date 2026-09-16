export interface DatasetIndex {
  moods: Record<string, string>;
  genres: Record<string, string>;
}

export interface TrackItem {
  id: string;
  title: string;
  isSong: boolean;
  duration: number;
  durationStr: string;
  thumbnailId: string;
  author: string;
  authorId: string | null;
}

export interface PlaylistItem {
  id: string;
  name: string;
  thumbnailId: string;
  tracks?: TrackItem[];
}

export type CategoryDetails = Record<string, PlaylistItem[]>;

export interface CategoryItem {
  name: string;
  slug: string;
  id: string;
}

export interface FullDataset {
  moods: Record<string, CategoryDetails>;
  genres: Record<string, CategoryDetails>;
}
