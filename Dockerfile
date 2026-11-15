# Console bundle image (Requirement 21.22, design: Console built into the API image).
# Holds only the built static files, under /console. It is never run: the Depot API image copies it in with
#   COPY --from=fholisani/depot-console-bundle:<tag> /console/ /app/static/depot-console/
# so each blue/green slot serves the Console it was built with. The files live in a subdirectory
# because kaniko cannot copy a stage's root (`/`): it trips over /proc while snapshotting.
FROM scratch
COPY dist/depot-console/browser/ /console/
