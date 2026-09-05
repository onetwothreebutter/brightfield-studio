# Image Generation Prompts

Provenance log for AI-generated images used on the website. When you generate a new
image for the site (hero, lifestyle, marketing), add an entry here before/when you
commit the asset, so the prompt that produced it stays attached to the file.

## How to add an entry

1. Copy the template below.
2. Fill in the asset path(s), tool/model, full prompt text, and any reference
   images or params used (e.g. aspect ratio, seed, input artwork).
3. Note anything about the generation that isn't obvious from the prompt alone
   (how many attempts it took, what was manually touched up, etc.).

```markdown
## `assets/<filename>.webp`

- **Tool/model:** <e.g. Nano Banana>
- **Date:** YYYY-MM-DD
- **Reference inputs:** <e.g. product artwork PNG, prior image, none>
- **Notes:** <anything non-obvious — retouching, cropping, why this vs. alternatives>

**Prompt:**

> <full prompt text>
```

---

## `assets/hero-poster.webp`, `assets/hero-poster-mobile.webp`

- **Tool/model:** Nano Banana
- **Date:** 2026-07-26
- **Reference inputs:** Shirt artwork image (Chladni shader design) supplied as input to preserve exact print appearance
- **Notes:** Homepage hero background. Mobile variant is a cropped/re-composed version of the same generation for portrait use.

**Prompt:**

> Create a cinematic homepage hero image for Brightfield, a brand that creates graphic T-shirts featuring artwork generated with WebGL shaders.
>
> A thoughtfully dressed young adult stands naturally in an ancient European-inspired stone street surrounded by weathered limestone buildings, carved arches, ivy-covered walls, worn stone steps, and centuries-old architectural details. The scene should feel timeless, quiet, and authentic rather than touristy or medieval fantasy.
>
> The architecture is the primary subject. It should communicate craftsmanship, permanence, texture, and history. Warm late-afternoon sunlight grazes the stone, revealing subtle variations in color and age. Long shadows create depth and drama. Cobblestones, stone courtyards, and narrow passageways invite exploration.
>
> The model wears a Bella+Canvas 3001-style black graphic T-shirt featuring the provided artwork. The shirt should feel like a natural part of the scene rather than the center of attention. Preserve the artwork exactly, including its colors, proportions, placement, and print appearance.
>
> The model appears intelligent, quietly confident, and creatively curious. They are observing the architecture or looking down the street—not posing for the camera. Their body language is relaxed and contemplative.
>
> Art direction: understated luxury, editorial fashion, architectural photography, natural textures, timeless craftsmanship, quiet sophistication, cinematic realism, subtle warmth.
>
> Avoid crowds, vehicles, storefront signs, modern advertisements, plastic furniture, bright colors, obvious tourist landmarks, fantasy elements, exaggerated HDR processing, or heavy stylization.
>
> Composition: ultra-wide 16:9 landscape suitable for a website hero. Position the model slightly off-center using the rule of thirds, leaving generous negative space across one side for a headline and call-to-action. The image should immediately communicate that Brightfield exists at the intersection of digital generative art and enduring human craftsmanship.
