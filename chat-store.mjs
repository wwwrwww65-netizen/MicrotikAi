import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = path.join(process.cwd(), 'chats.json');
const LIMIT = 100;

function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }

async function readAll() {
  try { return JSON.parse(await fs.readFile(FILE, 'utf8')); }
  catch { return []; }
}
async function writeAll(chats) {
  await fs.writeFile(FILE, JSON.stringify(chats, null, 2));
}

export async function listChats() {
  const chats = await readAll();
  return chats
    .map(c => ({ id:c.id, title:c.title, createdAt:c.createdAt, updatedAt:c.updatedAt, messageCount:Array.isArray(c.messages)?c.messages.length:0 }))
    .sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function createChat(title='محادثة جديدة') {
  const chats = await readAll();
  const chat = { id:id(), title:String(title || 'محادثة جديدة').slice(0,120), createdAt:now(), updatedAt:now(), messages:[] };
  chats.push(chat);
  if (chats.length > LIMIT) chats.splice(0, chats.length-LIMIT);
  await writeAll(chats);
  return chat;
}

export async function getChat(chatId) {
  const chats = await readAll();
  return chats.find(c => c.id === chatId) || null;
}

export async function renameChat(chatId,title) {
  const chats = await readAll();
  const chat = chats.find(c => c.id === chatId);
  if (!chat) throw new Error('المحادثة غير موجودة');
  chat.title=String(title || 'محادثة جديدة').trim().slice(0,120) || 'محادثة جديدة';
  chat.updatedAt=now();
  await writeAll(chats);
  return chat;
}

export async function deleteChat(chatId) {
  const chats = await readAll();
  const next = chats.filter(c => c.id !== chatId);
  if (next.length === chats.length) return false;
  await writeAll(next);
  return true;
}

export async function appendMessage(chatId, message) {
  const chats = await readAll();
  const chat = chats.find(c => c.id === chatId);
  if (!chat) throw new Error('المحادثة غير موجودة');
  const item = {
    id:id(),
    role:message.role === 'assistant' ? 'assistant' : 'user',
    content:String(message.content || ''),
    meta:message.meta || '',
    createdAt:now()
  };
  chat.messages.push(item);
  chat.messages = chat.messages.slice(-120);
  if (chat.messages.length === 1 && item.role === 'user') {
    chat.title = item.content.length > 48 ? `${item.content.slice(0,48)}…` : item.content;
  }
  chat.updatedAt=now();
  await writeAll(chats);
  return item;
}

export async function clearChat(chatId) {
  const chats = await readAll();
  const chat = chats.find(c => c.id === chatId);
  if (!chat) throw new Error('المحادثة غير موجودة');
  chat.messages=[];
  chat.updatedAt=now();
  await writeAll(chats);
  return chat;
}
