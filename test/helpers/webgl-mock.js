import { vi } from 'vitest';

/**
 * Returns a minimal WebGL mock that always reports successful shader
 * compilation and program linking, and records all calls via vi.fn().
 */
export function makeWebGLMock() {
  return {
    // Constants
    VERTEX_SHADER:           35633,
    FRAGMENT_SHADER:         35632,
    ARRAY_BUFFER:            34962,
    STATIC_DRAW:             35044,
    FLOAT:                   5126,
    COMPILE_STATUS:          35713,
    LINK_STATUS:             35714,
    TEXTURE_2D:              3553,
    TEXTURE0:                33984,
    TEXTURE_MIN_FILTER:      10241,
    TEXTURE_MAG_FILTER:      10240,
    TEXTURE_WRAP_S:          10242,
    TEXTURE_WRAP_T:          10243,
    LINEAR:                  9729,
    CLAMP_TO_EDGE:           33071,
    RGBA:                    6408,
    UNSIGNED_BYTE:           5121,
    TRIANGLE_STRIP:          5,
    UNPACK_FLIP_Y_WEBGL:     37440,

    // Methods
    getExtension:            vi.fn(),
    createShader:            vi.fn(() => ({})),
    shaderSource:            vi.fn(),
    compileShader:           vi.fn(),
    getShaderParameter:      vi.fn(() => true),   // always "compiled OK"
    deleteShader:            vi.fn(),
    createProgram:           vi.fn(() => ({})),
    attachShader:            vi.fn(),
    linkProgram:             vi.fn(),
    getProgramParameter:     vi.fn(() => true),   // always "linked OK"
    useProgram:              vi.fn(),
    createBuffer:            vi.fn(() => ({})),
    bindBuffer:              vi.fn(),
    bufferData:              vi.fn(),
    getAttribLocation:       vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer:     vi.fn(),
    getUniformLocation:      vi.fn((_prog, name) => ({ _loc: name })),
    uniform1f:               vi.fn(),
    uniform2f:               vi.fn(),
    uniform1i:               vi.fn(),
    uniform3fv:              vi.fn(),
    activeTexture:           vi.fn(),
    bindTexture:             vi.fn(),
    createTexture:           vi.fn(() => ({})),
    texImage2D:              vi.fn(),
    texParameteri:           vi.fn(),
    pixelStorei:             vi.fn(),
    viewport:                vi.fn(),
    drawArrays:              vi.fn(),
    FRAMEBUFFER:             36160,
    COLOR_ATTACHMENT0:       36064,
    createFramebuffer:       vi.fn(() => ({})),
    bindFramebuffer:         vi.fn(),
    framebufferTexture2D:    vi.fn(),
  };
}

/**
 * A minimal mock for a Canvas 2D context, suitable for verifying
 * what drawText implementations draw.
 */
export function make2DContextMock() {
  return {
    fillStyle:   '',
    strokeStyle: '',
    font:        '',
    textAlign:   '',
    textBaseline: '',
    lineWidth:   0,
    lineJoin:    '',
    fillRect:    vi.fn(),
    fillText:    vi.fn(),
    strokeText:  vi.fn(),
    save:        vi.fn(),
    restore:     vi.fn(),
    scale:       vi.fn(),
    translate:   vi.fn(),
    rotate:      vi.fn(),
  };
}
