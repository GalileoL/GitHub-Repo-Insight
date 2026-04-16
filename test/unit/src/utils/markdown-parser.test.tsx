import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderMarkdownInline } from '../../../../src/utils/markdown-parser';

describe('renderMarkdownInline url safety', () => {
  it('renders allowed links as anchors', () => {
    const nodes = renderMarkdownInline('See [repo](https://github.com/owner/repo)');
    const anchor = nodes.find((node) => React.isValidElement(node) && node.type === 'a');

    expect(anchor).toBeTruthy();
    if (React.isValidElement(anchor)) {
      expect(anchor.props.href).toBe('https://github.com/owner/repo');
    }
  });

  it('renders blocked links as plain text spans', () => {
    const nodes = renderMarkdownInline('Click [malicious](javascript:alert(1)) now');
    const span = nodes.find((node) => React.isValidElement(node) && node.type === 'span');

    expect(span).toBeTruthy();
    if (React.isValidElement(span)) {
      expect(span.props.children).toBe('malicious');
    }
  });

  it('replaces blocked image URLs with a placeholder', () => {
    const nodes = renderMarkdownInline('![img](https://example.com/x.png)');
    const span = nodes.find((node) => React.isValidElement(node) && node.type === 'span');

    expect(span).toBeTruthy();
    if (React.isValidElement(span)) {
      expect(span.props.children).toBe('[Blocked unsafe image URL]');
    }
  });
});
