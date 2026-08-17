declare module '@commandcode/harness' {
  export interface ModApi {
    name: string;
    cwd: string;
    session: any;
    events: any;
    ui: {
      notify(msg: string, level?: 'info' | 'warning'): void;
      setStatus(text: string): void;
      confirm(msg: string): Promise<boolean>;
      select(msg: string, options: string[]): Promise<string>;
      input(msg: string): Promise<string>;
    };
    sessions: any;
    addFlag(name: string, opts: {type: 'boolean' | 'string'; default?: any; description?: string}): {dispose(): void};
    addTool(tool: any): {dispose(): void};
    addCommand(cmd: {name: string; description?: string; handler: (ctx: any) => any}): {dispose(): void};
    hooks(hooks: Record<string, any>): {dispose(): void};
    on(event: string, handler: (...args: any[]) => void): {dispose(): void};
    getFlag(name: string): any;
    showEntry(type: string, data?: any): void;
    queueMessage(msg: {content: string; deliverAs?: 'steer' | 'follow-up'}): void;
    exec(cmd: {command: string; args?: string[]}): Promise<{stdout: string; stderr: string; code: number}>;
  }
}
