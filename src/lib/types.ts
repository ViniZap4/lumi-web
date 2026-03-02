export interface Note {
  id: string;
  title: string;
  content?: string;
  path?: string;
  created_at: string;
  updated_at: string;
  tags: string[];
}

export interface Folder {
  name: string;
  path: string;
}

export interface DisplayItem {
  type: 'note' | 'folder';
  name: string;
  id?: string;
  path?: string;
  data: Note | Folder;
}

export interface WsMessage {
  type: string;
  note?: Note;
  origin?: string;
}

export interface CmdModal {
  kind: 'input' | 'select' | 'confirm';
  title: string;
  placeholder?: string;
  message?: string;
  items?: { label: string; value: string }[];
  onSubmit: (...args: any[]) => Promise<void>;
}

export type ViewMode = 'home' | 'tree' | 'note' | 'config';

export type ThemeMode = 'dark' | 'light' | 'auto';

export type SearchType = 'filename' | 'content';
