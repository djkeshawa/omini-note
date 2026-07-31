function createSmartViewYamlHelpers({ smartViewIsPlainObject, smartViewValidateSavedDefinition }) {
  function smartViewYamlJson(value) {
    return JSON.stringify(value)
      .replace(/\u0085/g, '\\u0085')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function smartViewYamlScalar(value) {
    if (Array.isArray(value) || smartViewIsPlainObject(value)) return smartViewYamlJson(value);
    const text = String(value ?? '');
    const implicitScalar = /^(?:~|null|true|false|yes|no|on|off)$/i.test(text)
      || /^[-+]?(?:\d[\d_]*(?:\.[\d_]*)?(?:e[-+]?\d+)?|0x[\da-f_]+|0o[0-7_]+|0b[01_]+|\.(?:inf|nan))$/i.test(text)
      || /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[-+]\d{2}(?::?\d{2})?)?)?$/.test(text);
    const unsafePlainScalar = !text
      || text.trim() !== text
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text)
      || /^[-?:,\[\]{}#&*!|>'"%@`]/.test(text)
      || /[:#]/.test(text)
      || /^(?:---|\.\.\.)$/.test(text)
      || implicitScalar;
    if (unsafePlainScalar) return smartViewYamlJson(text);
    return text;
  }

  function smartViewYamlStructuredField(path = '') {
    const [parent, key] = String(path || '').split('.');
    if (!key) return ['filters', 'query', 'sort', 'group', 'columns'].includes(parent);
    if (parent !== 'filters' && parent !== 'query') return false;
    return [
      'tag', 'tags',
      'property', 'properties',
      'workflowStatus', 'workflowStatuses',
      'linkedNote', 'linkedNotes',
      'actionStatus', 'actionStatuses', 'taskStatus',
      'actionType', 'actionTypes',
    ].includes(key);
  }

  function smartViewParseYamlScalar(value, path = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.startsWith('"') && text.endsWith('"')) {
      try { return JSON.parse(text); } catch { return text; }
    }
    if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
    if (smartViewYamlStructuredField(path)
      && ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}')))) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return text;
  }

  function smartViewParseDefinitionYaml(text = '') {
    const root = Object.create(null);
    let activeMapKey = null;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
      if (/^\t/.test(rawLine)) throw new Error('Smart View YAML cannot use tabs for indentation');
      const indent = rawLine.match(/^ */)[0].length;
      const line = rawLine.trim();
      const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
      if (!match) throw new Error(`Unsupported Smart View YAML line: ${line.slice(0, 80)}`);
      const key = match[1];
      const value = match[2] || '';
      if (indent === 0) {
        if (value === '') {
          root[key] = Object.create(null);
          activeMapKey = key;
        } else {
          root[key] = smartViewParseYamlScalar(value, key);
          activeMapKey = null;
        }
        continue;
      }
      if (indent < 2 || !activeMapKey || !smartViewIsPlainObject(root[activeMapKey])) {
        throw new Error(`Unsupported Smart View YAML indentation near ${key}`);
      }
      root[activeMapKey][key] = smartViewParseYamlScalar(value, `${activeMapKey}.${key}`);
    }
    return root;
  }

  function smartViewSerializeDefinition(definition = {}, options = {}) {
    const format = typeof options === 'string' ? options : options.format || 'json';
    const saved = smartViewValidateSavedDefinition(definition);
    if (format !== 'yaml' && format !== 'yml') return JSON.stringify(saved, null, 2);
    const lines = [
      `format: ${smartViewYamlScalar(saved.format)}`,
      `id: ${smartViewYamlScalar(saved.id)}`,
      `title: ${smartViewYamlScalar(saved.title)}`,
      `type: ${smartViewYamlScalar(saved.type)}`,
      'filters:',
    ];
    Object.entries(saved.filters).forEach(([key, value]) => {
      if (value === '' || (Array.isArray(value) && !value.length)) return;
      lines.push(`  ${key}: ${smartViewYamlScalar(value)}`);
    });
    lines.push('sort:');
    lines.push(`  field: ${smartViewYamlScalar(saved.sort.field)}`);
    lines.push(`  direction: ${smartViewYamlScalar(saved.sort.direction)}`);
    lines.push(`limit: ${saved.limit}`);
    lines.push(`layout: ${smartViewYamlScalar(saved.layout)}`);
    if (saved.group) {
      lines.push('group:');
      lines.push(`  by: ${smartViewYamlScalar(saved.group.by)}`);
      lines.push(`  direction: ${smartViewYamlScalar(saved.group.direction)}`);
    }
    if (saved.columns) lines.push(`columns: ${smartViewYamlScalar(saved.columns)}`);
    return `${lines.join('\n')}\n`;
  }

  function smartViewParseDefinitionText(text = '', fileName = 'smart-view.json') {
    const clean = String(text || '').trim();
    const name = String(fileName || '').toLowerCase();
    const raw = name.endsWith('.yaml') || name.endsWith('.yml') || (!clean.startsWith('{') && !clean.startsWith('['))
      ? smartViewParseDefinitionYaml(clean)
      : JSON.parse(clean);
    return smartViewValidateSavedDefinition(raw);
  }

  return {
    smartViewYamlScalar,
    smartViewParseYamlScalar,
    smartViewParseDefinitionYaml,
    smartViewSerializeDefinition,
    smartViewParseDefinitionText,
  };
}

module.exports = { createSmartViewYamlHelpers };
