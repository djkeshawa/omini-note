function mnSidebarTagCounts(tags = [], notes = []) {
  const counts = new Map();
  for (const tag of tags || []) {
    if (tag?.name) counts.set(tag.name, 0);
  }
  for (const note of notes || []) {
    for (const tag of note?.tags || []) {
      if (counts.has(tag)) counts.set(tag, counts.get(tag) + 1);
    }
  }
  return counts;
}

export { mnSidebarTagCounts };
