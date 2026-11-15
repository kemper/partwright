// Stand-in for the handful of GLX calls a GLX-built GLEW makes during glewInit,
// answered from the software GL library (OSMesa) so a program that already has
// an OSMesa context current can initialise without an X server.
#define _GNU_SOURCE
#include <dlfcn.h>
#include <string.h>

typedef void (*proc)(void);
extern proc OSMesaGetProcAddress(const char *name);
extern void *OSMesaGetCurrentContext(void);

// Report a GLX display/context only while an OSMesa context really is current,
// so the shim can never claim a context that does not exist.
static void *current(void) { return OSMesaGetCurrentContext() ? (void *)1 : NULL; }

void *glXGetCurrentDisplay(void) { return current(); }
void *glXGetCurrentContext(void) { return current(); }
int glXQueryVersion(void *dpy, int *major, int *minor) {
  (void)dpy;
  if (major) *major = 1;
  if (minor) *minor = 4;
  return 1;
}
const char *glXGetClientString(void *dpy, int name) { (void)dpy; (void)name; return ""; }
const char *glXQueryExtensionsString(void *dpy, int screen) { (void)dpy; (void)screen; return ""; }

proc glXGetProcAddressARB(const unsigned char *name) {
  const char *n = (const char *)name;
  if (!n) return NULL;
  if (strncmp(n, "glX", 3) == 0) return (proc)dlsym(RTLD_DEFAULT, n);
  return OSMesaGetProcAddress(n);
}
proc glXGetProcAddress(const unsigned char *name) { return glXGetProcAddressARB(name); }
