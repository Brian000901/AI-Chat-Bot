const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

class HistoryStore extends Map {
    constructor(root) {
        super();
        this.root = root;
        this.guilds = new Map();
        fs.mkdirSync(root, { recursive: true });
        for (const guild of fs.readdirSync(root).filter(name => /^\d+$/.test(name))) {
            const guildPath = path.join(root, guild);
            if (!fs.statSync(guildPath).isDirectory()) continue;
            for (const channel of fs.readdirSync(guildPath).filter(name => /^\d+$/.test(name))) {
                const location = path.join(guildPath, channel, 'messages.json');
                if (!fs.existsSync(location)) continue;
                try {
                    const records = JSON.parse(fs.readFileSync(location, 'utf8'));
                    if (!Array.isArray(records) || records.some(record => !Array.isArray(record.parts))) throw new Error('Invalid history');
                    this.guilds.set(channel, guild);
                    super.set(channel, records);
                } catch (error) { log('error', '無法載入對話紀錄', { guild, channel, error: error.message }); }
            }
        }
    }
    bind(channel, guild) {
        if (!/^\d+$/.test(channel) || !/^\d+$/.test(guild)) throw new Error('Invalid Discord ID');
        this.guilds.set(channel, guild);
    }
    set(channel, records) {
        const guild = this.guilds.get(channel);
        if (!guild) throw new Error('History guild not registered');
        const directory = path.join(this.root, guild, channel);
        fs.mkdirSync(directory, { recursive: true });
        const serialized = records.map(record => ({ ...record, parts: record.parts.map(part =>
            part.inlineData ? { text: '[舊版附件需重新上傳。]' } : part) }));
        const temp = path.join(directory, 'messages.json.tmp');
        fs.writeFileSync(temp, JSON.stringify(serialized, null, 2));
        fs.renameSync(temp, path.join(directory, 'messages.json'));
        return super.set(channel, records);
    }
    delete(channel) {
        this.set(channel, []);
        return super.delete(channel);
    }
}

function fitHistory(records, currentParts) {
    const result = [...records];
    // URI length does not reflect model input cost. Also cap referenced media bytes/count.
    const limit = 100000;
    const currentSize = JSON.stringify(currentParts).length;
    const mediaOverBudget = () => {
        const files = [...result.flatMap(record => record.parts), ...currentParts].filter(part => part.cloudFile);
        return files.length > 20 || files.reduce((sum, part) => sum + Number(part.cloudFile.sizeBytes || 0), 0) > 24 * 1024 * 1024;
    };
    while (result.length && (result.length > 100 || JSON.stringify(result).length + currentSize > limit || mediaOverBudget())) result.splice(0, 2);
    return result;
}
module.exports = { HistoryStore, fitHistory };
