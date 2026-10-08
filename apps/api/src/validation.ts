import { BadRequestException } from "@nestjs/common";
export function text(v: unknown, label: string, max = 2000) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new BadRequestException(`${label}: ערך חסר או לא תקין`);
  return v.trim();
}
export function optional(v: unknown, max = 2000) {
  if (v == null || v === "") return "";
  if (typeof v !== "string" || v.length > max)
    throw new BadRequestException("טקסט לא תקין");
  return v.trim();
}
export function integer(v: unknown, label: string, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max)
    throw new BadRequestException(`${label}: מספר לא תקין`);
  return Number(v);
}
export function date(v: unknown, label: string) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new BadRequestException(`${label}: תאריך לא תקין`);
  const d = new Date(v + "T00:00:00Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== v)
    throw new BadRequestException(`${label}: תאריך לא תקין`);
  return d;
}
export function choice(v: unknown, values: string[], label: string) {
  const s = text(v, label, 100);
  if (!values.includes(s))
    throw new BadRequestException(`${label}: בחירה לא תקינה`);
  return s;
}
export function bool(v: unknown, label: string) {
  if (typeof v !== "boolean")
    throw new BadRequestException(`${label}: יש לבחור כן או לא`);
  return v;
}
export const today = () =>
  new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
