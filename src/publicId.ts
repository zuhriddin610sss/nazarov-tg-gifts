import { randomInt } from "node:crypto";

// Chalkashadigan belgilar (0/O, 1/I/L) chiqarib tashlangan
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newPublicId(): string {
  let s = "NG-";
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}
