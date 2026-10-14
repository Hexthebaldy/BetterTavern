/**
 * 增量 SSE 解析：按字节喂入，按事件吐出。
 *
 * - UTF-8 用 TextDecoder 的 stream 模式解码：中文是多字节字符，一个字可能被拆在两个 chunk 里；
 * - 处理 \n、\r\n、\r 三种行尾（包括 \r\n 被拆在两个 chunk 里）、多行 data、注释行和开头的 BOM；
 * - 只用标准 Web API，React Native（expo/fetch）和 Node 测试里都能跑。
 */

export type SseMessage = {
  /** 本事件的 id；没有 id 字段时为 undefined */
  id?: string;
  /** 事件类型，缺省为 "message" */
  event: string;
  data: string;
  retry?: number;
};

export class SseParser {
  private readonly decoder = new TextDecoder("utf-8");
  private buffer = "";
  private dataLines: string[] = [];
  private eventType = "";
  private eventId: string | undefined;
  private retry: number | undefined;
  private firstLine = true;
  /** 收到的注释行数（服务端的 keepalive） */
  comments = 0;
  /** 最近一个已派发事件的 id，断线重连时作为 Last-Event-ID */
  lastEventId: string | undefined;

  feed(chunk: Uint8Array): SseMessage[] {
    return this.feedText(this.decoder.decode(chunk, { stream: true }));
  }

  /**
   * 流结束时调用：冲掉解码器里剩下的字节。没有以空行收尾的事件按规范丢弃——流在事件中途结束，
   * 说明这个事件可能被截断了；丢弃后 Last-Event-ID 停在上一个完整事件，重连时服务端会补发它。
   */
  end(): SseMessage[] {
    const messages = this.feedText(this.decoder.decode());
    if (this.buffer.endsWith("\r")) {
      // 最后一个字符是 \r：它本身就是行尾（后面不会再有 \n 了）
      this.buffer = this.buffer.slice(0, -1);
      messages.push(...this.feedText("\n"));
    }
    this.buffer = "";
    this.dataLines = [];
    this.eventType = "";
    this.eventId = undefined;
    this.retry = undefined;
    return messages;
  }

  feedText(text: string): SseMessage[] {
    this.buffer += text;
    const messages: SseMessage[] = [];
    let position = 0;
    const buffer = this.buffer;
    while (position < buffer.length) {
      const nl = buffer.indexOf("\n", position);
      const cr = buffer.indexOf("\r", position);
      if (nl === -1 && cr === -1) break;
      let line: string;
      if (cr !== -1 && (nl === -1 || cr < nl)) {
        if (cr === buffer.length - 1) break; // 看不到下一个字符，不知道是不是 \r\n
        line = buffer.slice(position, cr);
        position = buffer[cr + 1] === "\n" ? cr + 2 : cr + 1;
      } else {
        line = buffer.slice(position, nl);
        position = nl + 1;
      }
      const message = this.processLine(line);
      if (message) messages.push(message);
    }
    this.buffer = buffer.slice(position);
    return messages;
  }

  private processLine(rawLine: string): SseMessage | undefined {
    let line = rawLine;
    if (this.firstLine) {
      this.firstLine = false;
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    }
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) {
      this.comments += 1;
      return undefined;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        this.dataLines.push(value);
        break;
      case "event":
        this.eventType = value;
        break;
      case "id":
        if (!value.includes("\u0000")) this.eventId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break;
    }
    return undefined;
  }

  private dispatch(): SseMessage | undefined {
    // 和规范一致：事件派发时才更新 lastEventId（被丢弃的半截事件不算）
    if (this.eventId !== undefined) this.lastEventId = this.eventId;
    if (this.dataLines.length === 0) {
      this.eventType = "";
      this.eventId = undefined;
      this.retry = undefined;
      return undefined;
    }
    const message: SseMessage = {
      event: this.eventType || "message",
      data: this.dataLines.join("\n"),
    };
    if (this.eventId !== undefined) message.id = this.eventId;
    if (this.retry !== undefined) message.retry = this.retry;
    this.dataLines = [];
    this.eventType = "";
    this.eventId = undefined;
    this.retry = undefined;
    return message;
  }
}
