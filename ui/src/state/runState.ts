//! Extraction run state machine.

export type RunStatus = "idle" | "running" | "cancelling" | "done" | "error";

export class RunState {
  status: RunStatus = "idle";
  progress = 0;
  log: string[] = [];

  setStatus(s: RunStatus): void {
    this.status = s;
  }

  setProgress(n: number): void {
    this.progress = n;
  }

  appendLog(line: string): void {
    this.log.push(line);
  }

  reset(): void {
    this.progress = 0;
    this.log = [];
    this.status = "idle";
  }
}
