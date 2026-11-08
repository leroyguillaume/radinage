import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { resetViewport } from "./__tests__/viewport";

globalThis.ResizeObserver = class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
};

Element.prototype.scrollIntoView = () => {};

resetViewport();
afterEach(resetViewport);
