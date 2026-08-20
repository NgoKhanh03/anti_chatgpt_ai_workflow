import { redactValue } from './redaction.js';
export class StructuredLogger {
    sink;
    context;
    constructor(sink = (line) => console.log(line), context = {}) {
        this.sink = sink;
        this.context = context;
    }
    child(context) {
        return new StructuredLogger(this.sink, { ...this.context, ...context });
    }
    log(level, event, data) {
        const record = redactValue({
            timestamp: new Date().toISOString(),
            level,
            event,
            ...this.context,
            ...(data === undefined ? {} : { data }),
        });
        this.sink(JSON.stringify(record));
    }
    debug(event, data) { this.log('debug', event, data); }
    info(event, data) { this.log('info', event, data); }
    warn(event, data) { this.log('warn', event, data); }
    error(event, data) { this.log('error', event, data); }
}
