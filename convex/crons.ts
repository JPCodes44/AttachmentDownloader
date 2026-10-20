import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("fail stale scans", { minutes: 5 }, internal.scans.failStaleScans, {});
crons.interval("delete old scans", { hours: 24 }, internal.scans.deleteOldScans, {});

export default crons;
