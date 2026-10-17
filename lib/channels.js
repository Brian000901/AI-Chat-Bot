const fs = require('fs');
const path = require('path');

class ChannelStore {
    constructor(filePath) {
        this.filePath = filePath;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        this.data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
        if (!this.data || typeof this.data !== 'object' || Array.isArray(this.data)
            || (this.data.channels !== undefined && (!Array.isArray(this.data.channels)
                || this.data.channels.some(id => typeof id !== 'string' || !/^\d+$/.test(id))))) {
            throw new Error('Invalid channels.json: expected a channels array of Discord IDs');
        }
        this.channels = new Set(this.data.channels || []);
    }
    has(id) { return this.channels.has(id); }
    add(id) {
        if (!/^\d+$/.test(id) || typeof id !== 'string') throw new Error('Invalid Discord channel ID');
        if (this.has(id)) return;
        this.save(new Set([...this.channels, id]));
    }
    delete(id) {
        if (!this.has(id)) return;
        const next = new Set(this.channels);
        next.delete(id);
        this.save(next);
    }
    save(next) {
        const data = { ...this.data, channels: [...next] };
        const temporary = this.filePath + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n');
        fs.renameSync(temporary, this.filePath);
        // Update memory only after the disk write succeeds.
        this.data = data;
        this.channels = next;
    }
}
module.exports = { ChannelStore };
