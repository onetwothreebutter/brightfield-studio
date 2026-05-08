import '@shopify/ui-extensions/preact';
import { render } from 'preact';

export default function extension() {
  render(<Extension />, document.body);
}

function Extension() {
  const line = shopify.target.value;
  const attributes = line?.attributes ?? [];
  const designUrl = attributes.find((attr) => attr.key === '_checkout_image')?.value
    ?? attributes.find((attr) => attr.key === '_design_url')?.value;

  if (designUrl) {
    return (
      <s-box padding="base">
        <s-stack direction="block" gap="small">
          <s-text>Your custom design:</s-text>
          <s-image src={designUrl} alt="Your custom shader design" />
        </s-stack>
      </s-box>
    );
  }

  return null;
}
