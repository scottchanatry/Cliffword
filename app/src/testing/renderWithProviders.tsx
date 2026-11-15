/**
 * Test helper: render a component inside the app's providers (en-es pair, i18n) with test
 * services (all fakes, on a FakeClock). The result carries the services so the test can drive
 * the fakes: `const { services } = await renderWithProviders(<X />);`.
 */
import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react-native';
import { AppProviders } from '../providers/AppProviders';
import type { Services } from '../services';
import { createTestServices, type TestServices } from '../services/testServices';

export interface RenderWithProvidersOptions<S extends Services> extends RenderOptions {
  /** Defaults to createTestServices(). */
  services?: S;
}

export async function renderWithProviders<S extends Services = TestServices>(
  ui: ReactElement,
  { services, ...options }: RenderWithProvidersOptions<S> = {},
) {
  const used = (services ?? createTestServices()) as S;
  const result = await render(<AppProviders services={used}>{ui}</AppProviders>, options);
  return { ...result, services: used };
}
