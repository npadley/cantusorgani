import { typesetEntries } from "../../../lib/admin/typesetQueues";
export const GET = () => Response.json(Object.fromEntries(typesetEntries().map((e) => [e.file,
  { title:e.title, scans:e.scans, render:e.render, error:e.error, candidates:e.candidates }])));
