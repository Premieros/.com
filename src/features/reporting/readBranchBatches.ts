/** Keep multi-branch reports from fanning out every read at the same time. */
export async function readBranchBatches<T, R>(branches: readonly T[], read: (branch: T) => PromiseLike<R>): Promise<R[]> {
  const results: R[] = [];
  const batchSize = 6;
  for (let offset = 0; offset < branches.length; offset += batchSize) {
    results.push(...await Promise.all(branches.slice(offset, offset + batchSize).map(read)));
  }
  return results;
}
