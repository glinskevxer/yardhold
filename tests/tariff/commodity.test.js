import { describe, expect, it } from 'vitest';
import {
  STANDARD_COMMODITIES,
  commodity,
  commodityBook,
  matchLevel,
  stcc,
} from '../../src/tariff/commodity.js';
import { NotFoundError, ValidationError } from '../../src/core/errors.js';

const book = commodityBook(STANDARD_COMMODITIES);

describe('stcc', () => {
  it('strips spaces and hyphens', () => {
    expect(stcc('01 13-210')).toBe('0113210');
  });

  it('refuses anything but seven digits', () => {
    expect(() => stcc('011321')).toThrow(/seven digits/);
    expect(() => stcc('01132100')).toThrow(/seven digits/);
    expect(() => stcc('011321A')).toThrow(/seven digits/);
  });

  it('needs a string', () => {
    expect(() => stcc(113210)).toThrow(ValidationError);
  });
});

describe('commodity', () => {
  it('splits the code into its levels', () => {
    const record = commodity({ code: '0113210', name: 'corn', commodityClass: 'grain' });
    expect(record.section).toBe('01');
    expect(record.group).toBe('01132');
    expect(record.commodityClass).toBe('GRAIN');
  });

  it('needs a name and a class', () => {
    expect(() => commodity({ code: '0113210', commodityClass: 'GRAIN' })).toThrow(ValidationError);
    expect(() => commodity({ code: '0113210', name: 'corn' })).toThrow(ValidationError);
  });

  it('defaults the flags off', () => {
    const record = commodity({ code: '0113210', name: 'corn', commodityClass: 'GRAIN' });
    expect(record.hazmat).toBe(false);
    expect(record.requiresHeat).toBe(false);
  });

  it('is frozen', () => {
    expect(
      Object.isFrozen(commodity({ code: '0113210', name: 'corn', commodityClass: 'GRAIN' }))
    ).toBe(true);
  });
});

describe('exact lookup', () => {
  it('finds a code that is filed', () => {
    expect(book.get('0113210').name).toBe('corn');
    expect(book.exact('0113210').name).toBe('corn');
    expect(matchLevel(book, '0113210')).toBe('exact');
  });

  it('has nothing exact for a code that is not filed', () => {
    expect(book.exact('0113299')).toBeUndefined();
  });
});

describe('falling back up the hierarchy', () => {
  it('falls back to the group', () => {
    expect(book.find('0113299').commodityClass).toBe('GRAIN');
    expect(matchLevel(book, '0113299')).toBe('group');
  });

  it('falls back to the section', () => {
    expect(book.classOf('0199999')).toBe('GRAIN');
    expect(matchLevel(book, '0199999')).toBe('section');
  });

  it('gives up when even the section is unfiled', () => {
    expect(book.find('9999999')).toBeUndefined();
    expect(matchLevel(book, '9999999')).toBe('none');
    expect(book.classOf('9999999')).toBeUndefined();
    expect(() => book.get('9999999')).toThrow(NotFoundError);
  });

  it('keeps the first entry in a group as its representative', () => {
    const two = commodityBook([
      { code: '0113210', name: 'corn', commodityClass: 'GRAIN' },
      { code: '0113220', name: 'popcorn', commodityClass: 'SPECIALTY' },
    ]);
    expect(two.find('0113299').name).toBe('corn');
  });
});

describe('the book', () => {
  it('counts and lists in code order', () => {
    expect(book.size).toBe(6);
    expect(book.all()[0].code).toBe('0113210');
  });

  it('slices by class', () => {
    expect(book.ofClass('grain')).toHaveLength(2);
    expect(book.ofClass('NOTHING')).toEqual([]);
  });

  it('lists the hazmat commodities', () => {
    expect(
      book
        .hazmat()
        .map((entry) => entry.name)
        .sort()
    ).toEqual(['phenol', 'sodium hydroxide solution']);
  });

  it('knows which need heat', () => {
    expect(book.get('2818142').requiresHeat).toBe(true);
    expect(book.get('2812340').requiresHeat).toBe(false);
  });

  it('refuses a non array', () => {
    expect(() => commodityBook('nope')).toThrow(ValidationError);
  });

  it('is empty when it was given nothing', () => {
    expect(commodityBook().size).toBe(0);
  });
});
