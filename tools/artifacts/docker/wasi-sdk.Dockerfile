FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV RUSTUP_HOME=/opt/rustup
ENV CARGO_HOME=/opt/cargo
ENV PATH=/opt/cargo/bin:${PATH}

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  clang \
  cmake \
  curl \
  git \
  ninja-build \
  python3 \
  python3-pip \
  tar \
  xz-utils \
  build-essential \
  pkg-config \
  libncurses-dev \
  && rm -rf /var/lib/apt/lists/*

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --default-toolchain stable

WORKDIR /work
