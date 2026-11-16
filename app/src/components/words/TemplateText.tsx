import { Fragment, type ReactNode } from 'react';
import { Text, type TextProps } from '../../ui';

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * A translated pattern split around its placeholders, with each value (a string, or a
 * styled span) in place, ready to sit inside a Text. A placeholder without a value stays as
 * written. The pattern comes from t(key) without values, so the word order stays the
 * translation's.
 */
export function templateParts(template: string, values: Readonly<Record<string, ReactNode>>): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(template.slice(last, start));
    const name = match[1] ?? '';
    parts.push(name in values ? <Fragment key={`${name}-${start}`}>{values[name]}</Fragment> : match[0]);
    last = start + match[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts;
}

export interface TemplateTextProps extends TextProps {
  /** A translated pattern with {name} placeholders, e.g. t('gloss.line') without values. */
  template: string;
  /** Values by placeholder name. A node (a styled span) is placed inline. */
  values: Readonly<Record<string, ReactNode>>;
}

/** A translated sentence whose placeholders are styled spans ("puesto" in bold in "{word} · {gloss} · new for you"). */
export function TemplateText({ template, values, ...rest }: TemplateTextProps) {
  return <Text {...rest}>{templateParts(template, values)}</Text>;
}
