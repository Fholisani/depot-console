// Depot Console CI (Requirement 21.22): check the API types against the Depot contract, test,
// build, and publish the bundle image fholisani/depot-console-bundle:<tag>. There is no deploy
// step: the Depot API image copies the bundle in, so the Console ships with each API build.
pipeline {
    options {
        disableConcurrentBuilds(abortPrevious: true)
        skipStagesAfterUnstable()
    }

    environment {
        RELEASE     = "2026"
        IMAGE_NAME  = "fholisani/depot-console-bundle"
        IMAGE_TAG   = "${RELEASE}-${BUILD_NUMBER}"
    }

    agent {
        kubernetes {
            yamlFile 'jenkins/agent-pod.yaml'
        }
    }

    stages {
        stage('Install') {
            steps {
                container('node') {
                    sh 'node -v && npm -v && npm ci'
                }
            }
        }

        stage('Contract types') {
            // The committed TypeScript types must match contracts/depot.yaml, so the Console never
            // drifts from the API it calls. Regenerate with `npm run api:types` after a contract sync.
            steps {
                container('node') {
                    sh 'git config --global --add safe.directory "$PWD" && npm run api:check'
                }
            }
        }

        stage('Test') {
            steps {
                container('node') {
                    sh 'CI=1 npx ng test --watch=false'
                }
            }
        }

        stage('Build') {
            steps {
                container('node') {
                    sh 'npx ng build && ls -la dist/depot-console/browser'
                }
            }
        }

        stage('Publish bundle image') {
            steps {
                container('kaniko') {
                    sh """
                        /kaniko/executor \
                          --context=\$(pwd) \
                          --dockerfile=Dockerfile \
                          --destination=${IMAGE_NAME}:${IMAGE_TAG} \
                          --destination=${IMAGE_NAME}:latest
                    """
                }
            }
        }
    }

    post {
        success { echo "Published ${IMAGE_NAME}:${IMAGE_TAG}" }
        always { cleanWs() }
    }
}
