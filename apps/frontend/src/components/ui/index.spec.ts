import * as ui from './index';

describe('barrel de components/ui', () => {
  it.each([
    'Badge',
    'Button',
    'Card',
    'EmptyState',
    'FormField',
    'Input',
    'Spinner',
    'Toast',
    'cn',
    'useFormFieldContext',
  ])('exporta %s', (name) => {
    expect(ui).toHaveProperty(name);
    expect(ui[name as keyof typeof ui]).toBeDefined();
  });
});
