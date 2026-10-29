import { jsonCopy, fields, id, localized, freezeDeep, unique, validateEffects } from './validate.mjs';
import { validatePredicate } from './graph.mjs';

export function defineNarrativeCatalog(raw) {
  const catalog = jsonCopy(raw, 'catalog');
  fields(catalog, ['schemaVersion', 'interactions'], ['schemaVersion', 'interactions'], 'catalog');
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.interactions)) throw new TypeError('catalog: unsupported schemaVersion/interactions');
  unique(catalog.interactions.map(i => i.id), 'interactions');
  for (const interaction of catalog.interactions) {
    fields(interaction, ['id', 'type', 'label', 'options', 'variants'], ['id', 'type', 'label'], 'interaction');
    id(interaction.id, 'interaction ID');
    localized(interaction.label, `${interaction.id}.label`);
    if (!['photo', 'keepsake', 'message'].includes(interaction.type)) throw new TypeError('interaction: unknown type');
    if (interaction.type === 'message') {
      if (Object.hasOwn(interaction, 'options') || !Array.isArray(interaction.variants) || !interaction.variants.length) {
        throw new TypeError('message: variants required');
      }
      unique(interaction.variants.map(v => v.id), 'message variants');
      const tuples = [];
      for (const v of interaction.variants) {
        fields(v, ['id','recipient','intent','tone','attachmentId','when','preview','reply','effects'],
          ['id','recipient','intent','tone','preview','reply','effects'], 'message variant');
        for (const key of ['id', 'recipient', 'intent', 'tone']) id(v[key], `message ${key}`);
        if (v.attachmentId !== undefined) id(v.attachmentId, 'message attachmentId');
        validatePredicate(v.when);
        localized(v.preview, 'message preview');
        localized(v.reply, 'message reply');
        validateEffects(v.effects, 'message');
        tuples.push(JSON.stringify([v.recipient, v.intent, v.tone, v.attachmentId ?? null]));
      }
      unique(tuples, 'message tuples');
    } else {
      if (Object.hasOwn(interaction, 'variants') || !Array.isArray(interaction.options) || !interaction.options.length) {
        throw new TypeError('interaction: options required');
      }
      unique(interaction.options.map(o => o.id), 'options');
      for (const option of interaction.options) {
        fields(option, ['id','label','assetId','effects'], ['id','label','effects'], 'option');
        id(option.id, 'option ID');
        localized(option.label, 'option label');
        if (option.assetId !== undefined) id(option.assetId, 'asset ID');
        if (interaction.type !== 'photo' && option.assetId !== undefined) throw new TypeError('assetId only valid on photo');
        validateEffects(option.effects, 'option');
      }
    }
  }
  return freezeDeep(catalog);
}
