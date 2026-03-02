import type { Note, Folder } from './types.ts';

export const API_URL: string = import.meta.env.VITE_LUMI_SERVER_URL || 'http://localhost:8080';
let token = '';

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Lumi-Token': token,
  };
}

export function setToken(t: string): void { token = t; }
export function getToken(): string { return token; }

export async function login(password: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lumi-Token': password },
  });
  if (!res.ok) throw new Error('Invalid password');
  token = password;
  return true;
}

export async function getFolders(): Promise<Folder[]> {
  const res = await fetch(`${API_URL}/api/folders`, { headers: getHeaders() });
  if (!res.ok) throw new Error('Failed to fetch folders');
  return await res.json() || [];
}

export async function getNotes(path = ''): Promise<Note[]> {
  const url = path ? `${API_URL}/api/notes?path=${path}` : `${API_URL}/api/notes`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error('Failed to fetch notes');
  return await res.json() || [];
}

export async function getNote(id: string): Promise<Note> {
  const cleanId = id.replace(/\.md$/, '');
  const encodedId = encodeURIComponent(cleanId);
  const res = await fetch(`${API_URL}/api/notes/${encodedId}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch note: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function createNote(note: Partial<Note> & { folder?: string }): Promise<Note> {
  const res = await fetch(`${API_URL}/api/notes`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(note),
  });
  if (!res.ok) throw new Error('Failed to create note');
  return res.json();
}

export async function updateNote(id: string, note: Partial<Note>): Promise<Note> {
  const cleanId = id.replace(/\.md$/, '');
  const encodedId = encodeURIComponent(cleanId);
  const res = await fetch(`${API_URL}/api/notes/${encodedId}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(note),
  });
  if (!res.ok) throw new Error(`Failed to update note: ${res.status}`);
  return res.json();
}

export async function deleteNote(id: string): Promise<void> {
  const cleanId = id.replace(/\.md$/, '');
  const encodedId = encodeURIComponent(cleanId);
  const res = await fetch(`${API_URL}/api/notes/${encodedId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete note');
}

export async function moveNote(id: string, folder: string): Promise<Note> {
  const cleanId = id.replace(/\.md$/, '');
  const encodedId = encodeURIComponent(cleanId);
  const res = await fetch(`${API_URL}/api/notes/${encodedId}/move`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ folder }),
  });
  if (!res.ok) throw new Error('Failed to move note');
  return res.json();
}

export async function copyNote(id: string, newId: string, newTitle: string): Promise<Note> {
  const cleanId = id.replace(/\.md$/, '');
  const encodedId = encodeURIComponent(cleanId);
  const res = await fetch(`${API_URL}/api/notes/${encodedId}/copy`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ new_id: newId, new_title: newTitle }),
  });
  if (!res.ok) throw new Error('Failed to copy note');
  return res.json();
}

export async function renameNote(id: string, newId: string, newTitle: string): Promise<Note> {
  const cleanId = id.replace(/\.md$/, '');
  const encodedId = encodeURIComponent(cleanId);
  const res = await fetch(`${API_URL}/api/notes/${encodedId}/rename`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ new_id: newId, new_title: newTitle }),
  });
  if (!res.ok) throw new Error('Failed to rename note');
  return res.json();
}

export async function createFolder(name: string): Promise<Folder> {
  const res = await fetch(`${API_URL}/api/folders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to create folder');
  return res.json();
}

export async function renameFolder(name: string, newName: string): Promise<Folder> {
  const encodedName = encodeURIComponent(name);
  const res = await fetch(`${API_URL}/api/folders/${encodedName}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ new_name: newName }),
  });
  if (!res.ok) throw new Error('Failed to rename folder');
  return res.json();
}

export async function moveFolder(name: string, destination: string): Promise<Folder> {
  const encodedName = encodeURIComponent(name);
  const res = await fetch(`${API_URL}/api/folders/${encodedName}/move`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ destination }),
  });
  if (!res.ok) throw new Error('Failed to move folder');
  return res.json();
}

export async function deleteFolder(name: string): Promise<void> {
  const encodedName = encodeURIComponent(name);
  const res = await fetch(`${API_URL}/api/folders/${encodedName}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete folder');
}
