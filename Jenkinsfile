// Depot Console CI/CD (Requirement 21.22), the same flow as stokvel-admin: check the API types
// against the Depot contract, test, build, publish the nginx image fholisani/depot-console:<tag>,
// then set that tag on the passive slot in the deployment repo (prod/depot-console/values.yaml);
// Argo CD deploys it. Testers reach it with ?slot=passive; promote.sh makes it active.
pipeline {
    options {
        disableConcurrentBuilds(abortPrevious: true)
        skipStagesAfterUnstable()
    }

    environment {
        RELEASE        = "2026"
        IMAGE_NAME     = "fholisani/depot-console"
        IMAGE_TAG      = "${RELEASE}-${BUILD_NUMBER}"
        GIT_REPO_NAME  = "deployment"
        GIT_USER_NAME  = "Fholisani"
        GIT_USER_EMAIL = "mashegana@yahoo.com"
        VALUES_FILE    = "prod/depot-console/values.yaml"
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

        stage('Build & Push Image') {
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

        stage('Update Deployment Repo') {
            // Argo CD (app depot-console) watches this file and rolls the new image out.
            steps {
                container('node') {
                    sh 'mkdir -p ~/.ssh && ssh-keyscan github.com >> ~/.ssh/known_hosts'
                    sshagent(credentials: ['github-ssh-credential']) {
                        sh '''
                            git config --global user.email "${GIT_USER_EMAIL}"
                            git config --global user.name "${GIT_USER_NAME}"
                            rm -rf ${GIT_REPO_NAME}
                            git clone --depth 20 git@github.com:${GIT_USER_NAME}/${GIT_REPO_NAME}.git
                            cd ${GIT_REPO_NAME}
                            # New builds go to the passive slot only; promote with
                            # prod/depot-console/release/promote.sh once tested.
                            chmod +x prod/depot-console/release/*.sh
                            prod/depot-console/release/set-passive-image.sh "${IMAGE_TAG}"
                            git add ${VALUES_FILE}
                            git commit -m "depot-console: passive image ${IMAGE_TAG}" || { echo "No changes"; exit 0; }
                            # Other pipelines push here too; rebase and retry instead of failing.
                            for i in 1 2 3; do
                                git pull --rebase origin main && git push origin main && exit 0
                                sleep 5
                            done
                            exit 1
                        '''
                    }
                }
            }
        }
    }

    post {
        success { echo "Deployed ${IMAGE_NAME}:${IMAGE_TAG} (Argo CD syncs prod/depot-console)" }
        always { cleanWs() }
    }
}
