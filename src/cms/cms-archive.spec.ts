import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  archiveWhere,
  assertAllArchivedBeforeDelete,
  assertArchivedBeforeDelete,
  resolveArchiveFilter,
} from '../common/archive/archive.js';
import {
  mergeCmsSectionUpdate,
  removeArchivedCmsItem,
  resetCmsSectionKeepingCustomItems,
  setCmsItemArchived,
  stripArchivedItems,
} from './cms-archive.js';

const NOW = new Date('2026-11-19T10:00:00.000Z');
const live = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, active: true, ...extra });
const archived = (id: string) => live(id, { archivedAt: '2026-11-01T00:00:00.000Z' });

describe('common archive helpers', () => {
  it('builds Prisma where fragments for each filter', () => {
    expect(archiveWhere('exclude')).toEqual({ archivedAt: null });
    expect(archiveWhere('only')).toEqual({ archivedAt: { not: null } });
    expect(archiveWhere('include')).toEqual({});
    expect(archiveWhere()).toEqual({ archivedAt: null });
  });

  it('only lets admins see archived records', () => {
    expect(resolveArchiveFilter('only', true)).toBe('only');
    expect(resolveArchiveFilter('only', false)).toBe('exclude');
    expect(resolveArchiveFilter('include', false)).toBe('exclude');
  });

  it('refuses to permanently delete live records', () => {
    expect(() => assertArchivedBeforeDelete({ archivedAt: null }, 'Product "X"')).toThrow(ConflictException);
    expect(() => assertArchivedBeforeDelete({ archivedAt: NOW }, 'Product "X"')).not.toThrow();
    expect(() =>
      assertAllArchivedBeforeDelete([
        { archivedAt: NOW, label: 'A' },
        { archivedAt: null, label: 'B' },
      ]),
    ).toThrow(/B/);
  });
});

describe('CMS item archive', () => {
  describe('mergeCmsSectionUpdate (PUT /cms/:key)', () => {
    it('rejects a save that drops a live item', () => {
      const current = [live('feat-1'), live('feat-2')];
      expect(() => mergeCmsSectionUpdate('features', current, [live('feat-1')])).toThrow(ConflictException);
    });

    it('keeps archived items the client left out', () => {
      const current = [live('feat-1'), archived('feat-2')];
      const result = mergeCmsSectionUpdate('features', current, [live('feat-1', { title: 'Edited' })]);
      expect(result).toEqual([live('feat-1', { title: 'Edited' }), archived('feat-2')]);
    });

    it('allows edits, additions and reordering', () => {
      const current = [live('a'), live('b')];
      const incoming = [live('b'), live('a'), live('c')];
      expect(mergeCmsSectionUpdate('features', current, incoming)).toEqual(incoming);
    });

    it('works for lists nested in an object (header.navLinks)', () => {
      const current = { promoCode: 'X', navLinks: [live('nav-1'), live('nav-2')] };
      expect(() =>
        mergeCmsSectionUpdate('header', current, { promoCode: 'Y', navLinks: [live('nav-1')] }),
      ).toThrow(ConflictException);
    });

    it('keeps the stored list when the payload omits it', () => {
      const current = { title: 'T', partners: [live('p-1')] };
      expect(mergeCmsSectionUpdate('trusted_by', current, { title: 'New' })).toEqual({
        title: 'New',
        partners: [live('p-1')],
      });
    });

    it('ignores sections without an archivable list', () => {
      expect(mergeCmsSectionUpdate('terms', { content: 'a' }, { content: 'b' })).toEqual({ content: 'b' });
    });
  });

  describe('setCmsItemArchived', () => {
    it('archives and restores while keeping the active flag', () => {
      const data = [live('a', { active: false }), live('b')];
      const { data: afterArchive, item } = setCmsItemArchived('features', data, 'a', true, NOW);
      expect(item).toEqual(live('a', { active: false, archivedAt: NOW.toISOString() }));

      const { item: restored } = setCmsItemArchived('features', afterArchive, 'a', false, NOW);
      expect(restored).toEqual(live('a', { active: false, archivedAt: null }));
    });

    it('throws 404 for unknown items and 400 for non-list sections', () => {
      expect(() => setCmsItemArchived('features', [live('a')], 'zzz', true)).toThrow(NotFoundException);
      expect(() => setCmsItemArchived('terms', {}, 'a', true)).toThrow(BadRequestException);
    });
  });

  describe('removeArchivedCmsItem (DELETE /cms/:key/items/:id)', () => {
    it('deletes archived items only', () => {
      const data = { navLinks: [live('nav-1'), archived('nav-2')] };
      expect(removeArchivedCmsItem('header', data, 'nav-2')).toEqual({ navLinks: [live('nav-1')] });
      expect(() => removeArchivedCmsItem('header', data, 'nav-1')).toThrow(ConflictException);
    });
  });

  it('strips archived items for public readers', () => {
    expect(stripArchivedItems('banner_slides', [live('s1'), archived('s2')])).toEqual([live('s1')]);
    expect(stripArchivedItems('terms', { content: 'x' })).toEqual({ content: 'x' });
  });

  it('reset moves custom items to the archive instead of deleting them', () => {
    const defaults = [live('feat-1')];
    const current = [live('feat-1', { title: 'Edited' }), live('custom'), archived('old')];
    expect(resetCmsSectionKeepingCustomItems('features', current, defaults, NOW)).toEqual([
      live('feat-1'),
      live('custom', { archivedAt: NOW.toISOString() }),
      archived('old'),
    ]);
  });
});
