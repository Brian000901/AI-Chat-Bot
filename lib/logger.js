const COLORS = { success: 32, info: 36, search: 35, web: 36, warn: 33, error: 31, dim: 90 };

// Enable ANSI colors in hosted consoles too; NO_COLOR disables them for plain logs.
function paint(value, color) {
    return process.env.NO_COLOR !== undefined || process.env.FORCE_COLOR === '0'
        ? String(value) : `\x1b[${color}m${value}\x1b[0m`;
}
function clean(value) {
    return String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}
function log(kind, message, fields = {}) {
    if (typeof fields !== 'object' || fields === null) fields = { detail: fields };
    const time = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(new Date());
    const lines = [`${paint(`[${time} +08:00]`, COLORS.dim)} ${paint(`[${kind.toUpperCase()}]`, COLORS[kind] || COLORS.info)} ${clean(message)}`];
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            value.forEach((item, index) => lines.push(`  ${paint(`${clean(key)} ${index + 1}:`, COLORS.dim)} ${clean(item)}`));
        } else lines.push(`  ${paint(`${clean(key)}:`, COLORS.dim)} ${clean(value)}`);
    }
    // One write keeps concurrent channels' log entries together.
    (kind === 'error' ? console.error : console.log)(lines.join('\n'));
}
module.exports = { log };
